const MAX_PARALLEL_JOBS = 3;
const RECOMPRESS_DELAY_MS = 250;
const TOAST_DURATION_MS = 3500;
const SUPPORTED_FILE = /\.(png|jpe?g|pdf)$/i;
const LEVEL_STORAGE_KEY = "local-compress:level";
const BYTE_UNITS = ["B", "KB", "MB", "GB"];
const STATUS_LABELS = { queued: "Waiting", working: "Compressing" };
const LEVEL_HINTS = [
  [25, "Light — looks the same as the original"],
  [60, "Balanced — good quality at a much smaller size"],
  [85, "Strong — slight softening, very small files"],
  [100, "Maximum — smallest files, visible quality loss"],
];

const ui = {
  level: document.getElementById("level"),
  levelValue: document.getElementById("level-value"),
  levelHint: document.getElementById("level-hint"),
  dropzone: document.getElementById("dropzone"),
  picker: document.getElementById("picker"),
  results: document.getElementById("results"),
  list: document.getElementById("file-list"),
  summaryCount: document.getElementById("summary-count"),
  summarySizes: document.getElementById("summary-sizes"),
  summarySaved: document.getElementById("summary-saved"),
  saveAll: document.getElementById("save-all"),
  clear: document.getElementById("clear"),
  toast: document.getElementById("toast"),
  rowTemplate: document.getElementById("file-row"),
};

const jobs = new Set();
const queue = [];
let activeJobs = 0;
let recompressTimer;
let toastTimer;

ui.level.value = readStoredLevel() ?? ui.level.value;
renderLevel();

ui.level.addEventListener("input", renderLevel);
ui.level.addEventListener("change", onLevelCommitted);
ui.dropzone.addEventListener("click", () => ui.picker.click());
ui.picker.addEventListener("change", () => {
  addFiles(ui.picker.files);
  ui.picker.value = "";
});
ui.saveAll.addEventListener("click", saveAll);
ui.clear.addEventListener("click", clearAll);
document.addEventListener("dragover", onDragOver);
document.addEventListener("dragleave", onDragLeave);
document.addEventListener("drop", onDrop);

function renderLevel() {
  const level = Number(ui.level.value);
  const min = Number(ui.level.min);
  const fill = ((level - min) / (Number(ui.level.max) - min)) * 100;
  ui.levelValue.textContent = `${level}%`;
  ui.levelHint.textContent = LEVEL_HINTS.find(([upTo]) => level <= upTo)[1];
  ui.level.style.setProperty("--fill", `${fill}%`);
}

function onLevelCommitted() {
  storeLevel(ui.level.value);
  clearTimeout(recompressTimer);
  recompressTimer = setTimeout(() => jobs.forEach(schedule), RECOMPRESS_DELAY_MS);
}

function onDragOver(event) {
  event.preventDefault();
  document.body.classList.add("is-dragging");
}

function onDragLeave(event) {
  if (event.relatedTarget === null) document.body.classList.remove("is-dragging");
}

function onDrop(event) {
  event.preventDefault();
  document.body.classList.remove("is-dragging");
  addFiles(event.dataTransfer.files);
}

function addFiles(fileList) {
  const files = [...fileList];
  const supported = files.filter((file) => SUPPORTED_FILE.test(file.name));
  const skipped = files.length - supported.length;
  if (skipped > 0) showToast(`Skipped ${plural(skipped, "unsupported file")}. Use PNG, JPG or PDF.`);

  for (const file of supported) {
    const job = { file, state: "queued", blob: null, error: null };
    job.row = createRow(job);
    jobs.add(job);
    ui.list.append(job.row);
    schedule(job);
  }
  renderSummary();
}

function createRow(job) {
  const row = ui.rowTemplate.content.firstElementChild.cloneNode(true);
  const name = row.querySelector(".file-name");
  name.textContent = job.file.name;
  name.title = job.file.name;
  row.querySelector(".thumb").append(createThumbnail(job));
  row.querySelector(".save").addEventListener("click", () => saveJob(job));
  row.querySelector(".remove").addEventListener("click", () => removeJob(job));
  return row;
}

function createThumbnail(job) {
  const label = job.file.name.split(".").pop().toUpperCase();
  if (label === "PDF") return label;
  job.thumbnailUrl = URL.createObjectURL(job.file);
  const image = Object.assign(new Image(), { src: job.thumbnailUrl, alt: "", decoding: "async" });
  image.addEventListener("error", () => image.replaceWith(label), { once: true });
  return image;
}

function schedule(job) {
  job.controller?.abort();
  job.state = "queued";
  if (!queue.includes(job)) queue.push(job);
  renderJob(job);
  renderSummary();
  runQueue();
}

function runQueue() {
  while (activeJobs < MAX_PARALLEL_JOBS && queue.length > 0) {
    const job = queue.shift();
    activeJobs += 1;
    compressJob(job).finally(() => {
      activeJobs -= 1;
      runQueue();
    });
  }
}

async function compressJob(job) {
  const controller = new AbortController();
  job.controller = controller;
  job.state = "working";
  renderJob(job);

  const body = new FormData();
  body.append("file", job.file);
  body.append("level", ui.level.value);

  try {
    const response = await fetch("/api/compress", { method: "POST", body, signal: controller.signal });
    if (!response.ok) throw new Error(await readError(response));
    const blob = await response.blob();
    // A newer level or a removal superseded this request while it was in flight.
    if (controller.signal.aborted) return;
    setResult(job, blob);
  } catch (error) {
    if (controller.signal.aborted) return;
    job.state = "error";
    job.error = error instanceof TypeError ? "Can't reach the local server. Is it still running?" : error.message;
  }
  renderJob(job);
  renderSummary();
}

function setResult(job, blob) {
  revokeUrl(job.resultUrl);
  job.blob = blob;
  job.resultUrl = URL.createObjectURL(blob);
  job.state = "done";
  job.error = null;
}

function removeJob(job) {
  job.controller?.abort();
  const queued = queue.indexOf(job);
  if (queued !== -1) queue.splice(queued, 1);
  revokeUrl(job.thumbnailUrl);
  revokeUrl(job.resultUrl);
  job.row.remove();
  jobs.delete(job);
  renderSummary();
}

function clearAll() {
  jobs.forEach(removeJob);
}

function renderJob(job) {
  const { row, file, blob, state } = job;
  const sizes = row.querySelector(".file-sizes");
  const badge = row.querySelector(".badge");
  const preview = row.querySelector(".preview");
  const isDone = state === "done";

  row.dataset.state = state;
  row.querySelector(".save").disabled = !isDone;
  preview.setAttribute("aria-disabled", String(!isDone));
  if (isDone) preview.href = job.resultUrl;
  else preview.removeAttribute("href");

  if (isDone) {
    const saved = percentSaved(file.size, blob.size);
    sizes.textContent = `${formatBytes(file.size)} → ${formatBytes(blob.size)}`;
    badge.textContent = saved > 0 ? `−${saved}%` : "Already optimal";
  } else if (state === "error") {
    sizes.textContent = job.error;
    badge.textContent = "Failed";
  } else {
    sizes.textContent = formatBytes(file.size);
    badge.textContent = STATUS_LABELS[state];
  }
}

function renderSummary() {
  const all = [...jobs];
  const done = all.filter((job) => job.state === "done");
  const failed = all.filter((job) => job.state === "error").length;
  const pending = all.length - done.length - failed;
  const originalBytes = sumBy(done, (job) => job.file.size);
  const compressedBytes = sumBy(done, (job) => job.blob.size);
  const saved = percentSaved(originalBytes, compressedBytes);

  ui.results.hidden = all.length === 0;
  ui.saveAll.disabled = done.length === 0 || pending > 0;
  ui.summaryCount.textContent =
    pending > 0
      ? `Compressing ${pending} of ${plural(all.length, "file")}…`
      : `${plural(done.length, "file")} ready${failed ? ` · ${failed} failed` : ""}`;
  ui.summarySizes.textContent = done.length ? `${formatBytes(originalBytes)} → ${formatBytes(compressedBytes)}` : "";
  ui.summarySaved.textContent = saved > 0 ? `−${saved}%` : "";
}

async function saveJob(job) {
  const name = outputName(job.file.name);
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: name });
      await writeFile(handle, job.blob);
      showToast(`Saved ${handle.name}`);
    } else {
      downloadBlob(job.blob, name);
    }
  } catch (error) {
    reportSaveError(error);
  }
}

async function saveAll() {
  const ready = [...jobs].filter((job) => job.state === "done");
  const names = uniqueNames(ready.map((job) => outputName(job.file.name)));
  try {
    if (window.showDirectoryPicker) {
      const folder = await window.showDirectoryPicker({ id: "local-compress", mode: "readwrite" });
      for (const [index, job] of ready.entries()) {
        await writeFile(await folder.getFileHandle(names[index], { create: true }), job.blob);
      }
      showToast(`Saved ${plural(ready.length, "file")} to “${folder.name}”`);
    } else {
      downloadBlob(await zipBlobs(ready.map((job) => job.blob), names), "compressed-files.zip");
    }
  } catch (error) {
    reportSaveError(error);
  }
}

async function writeFile(handle, blob) {
  const stream = await handle.createWritable();
  await stream.write(blob);
  await stream.close();
}

async function zipBlobs(blobs, names) {
  const body = new FormData();
  blobs.forEach((blob, index) => body.append("files", blob, names[index]));
  const response = await fetch("/api/zip", { method: "POST", body });
  if (!response.ok) throw new Error(await readError(response));
  return response.blob();
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function reportSaveError(error) {
  if (error.name !== "AbortError") showToast(`Couldn't save: ${error.message}`);
}

async function readError(response) {
  const fallback = `Server error (${response.status})`;
  try {
    return (await response.json()).error ?? fallback;
  } catch {
    return fallback;
  }
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("is-visible"), TOAST_DURATION_MS);
}

function readStoredLevel() {
  try {
    return localStorage.getItem(LEVEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLevel(level) {
  try {
    localStorage.setItem(LEVEL_STORAGE_KEY, level);
  } catch {
    // Storage can be unavailable (private mode); remembering the level is optional.
  }
}

function outputName(name) {
  const dot = name.lastIndexOf(".");
  return `${name.slice(0, dot)}-compressed${name.slice(dot)}`;
}

function uniqueNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    return `${name.slice(0, dot)} (${count})${name.slice(dot)}`;
  });
}

function percentSaved(original, compressed) {
  if (compressed >= original) return 0;
  return Math.max(1, Math.round((1 - compressed / original) * 100));
}

function formatBytes(bytes) {
  const exponent = Math.min(Math.floor(Math.log10(Math.max(bytes, 1)) / 3), BYTE_UNITS.length - 1);
  const value = bytes / 1000 ** exponent;
  return `${value.toFixed(exponent === 0 || value >= 100 ? 0 : 1)} ${BYTE_UNITS[exponent]}`;
}

function sumBy(items, pick) {
  return items.reduce((total, item) => total + pick(item), 0);
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function revokeUrl(url) {
  if (url) URL.revokeObjectURL(url);
}
