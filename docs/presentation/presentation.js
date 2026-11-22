/* global document, history, location, window */

const slides = Array.from(document.querySelectorAll(".slide"));
const outline = document.querySelector("#outline");
const outlineLinks = Array.from(outline.querySelectorAll("a"));
const outlineToggle = document.querySelector("#outline-toggle");
const notesToggle = document.querySelector("#notes-toggle");
const presentToggle = document.querySelector("#present-toggle");
const exitPresent = document.querySelector("#exit-present");
const previous = document.querySelector("#previous-slide");
const next = document.querySelector("#next-slide");
const currentTime = document.querySelector("#current-time");
const slideCount = document.querySelector("#slide-count");
const slideProgress = document.querySelector("#slide-progress");
const flowSlide = document.querySelector("#message-flow");
const flowSteps = flowSlide.querySelector(".flow-steps");
const playFlow = document.querySelector("#play-flow");

let activeSlide;

function setOutline(open) {
  outline.classList.toggle("outline-open", open);
  outlineToggle.setAttribute("aria-expanded", String(open));
}

function renderSlide(slide) {
  if (activeSlide === flowSlide && slide !== flowSlide) resetFlow("Play message flow");
  activeSlide = slide;
  for (const item of slides) {
    item.hidden = item !== slide;
  }
  for (const link of outlineLinks) {
    if (link.hash === "#" + slide.id) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }

  const index = slides.indexOf(slide);
  const formatPosition = (position) => String(position).padStart(2, "0");

  currentTime.textContent = slide.dataset.time;
  slideCount.value = formatPosition(index + 1) + " / " + formatPosition(slides.length);
  slideProgress.max = slides.length;
  slideProgress.value = index + 1;
  previous.disabled = index === 0;
  next.disabled = index === slides.length - 1;

  setOutline(false);
  window.scrollTo(0, 0);
}

function goToSlide(slide) {
  if (!slide) return;
  if (slide !== activeSlide) history.pushState(null, "", "#" + slide.id);
  renderSlide(slide);
}

function showLinkedSlide() {
  const linked = slides.find((slide) => location.hash === "#" + slide.id);
  renderSlide(linked ?? slides[0]);
}

function moveSlide(direction) {
  goToSlide(slides[slides.indexOf(activeSlide) + direction]);
}

function resetFlow(label) {
  flowSteps.classList.remove("flow-playing", "flow-paused");
  playFlow.textContent = label;
}

playFlow.addEventListener("click", () => {
  if (flowSteps.classList.contains("flow-playing")) {
    const paused = flowSteps.classList.toggle("flow-paused");
    playFlow.textContent = paused ? "Resume message flow" : "Pause message flow";
    return;
  }

  flowSteps.classList.add("flow-playing");
  playFlow.textContent = "Pause message flow";
});

flowSteps.addEventListener("animationend", (event) => {
  if (event.animationName === "flow-highlight" && event.target === flowSteps.lastElementChild) {
    resetFlow("Replay message flow");
  }
});

function toggleNotes() {
  if (document.body.classList.contains("presenting")) return;
  const visible = document.body.classList.toggle("notes-visible");
  notesToggle.setAttribute("aria-pressed", String(visible));
  if (visible) {
    activeSlide.querySelector(".speaker-notes").scrollIntoView({ block: "nearest" });
  }
}

async function startPresentation() {
  setOutline(false);
  document.body.classList.add("presenting");
  window.scrollTo(0, 0);
  exitPresent.focus({ preventScroll: true });

  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    // The deck view also works when the browser blocks fullscreen.
  }
}

function restoreViewer() {
  document.body.classList.remove("presenting");
  presentToggle.focus({ preventScroll: true });
}

async function stopPresentation() {
  restoreViewer();
  if (document.fullscreenElement) await document.exitFullscreen();
}

for (const link of [...outlineLinks, document.querySelector(".brand")]) {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const focusOutlineToggle = outline.classList.contains("outline-open");
    goToSlide(slides.find((slide) => link.hash === "#" + slide.id));
    if (focusOutlineToggle) outlineToggle.focus({ preventScroll: true });
  });
}

outlineToggle.addEventListener("click", () => setOutline(!outline.classList.contains("outline-open")));
notesToggle.addEventListener("click", toggleNotes);
previous.addEventListener("click", () => moveSlide(-1));
next.addEventListener("click", () => moveSlide(1));
presentToggle.addEventListener("click", startPresentation);
exitPresent.addEventListener("click", stopPresentation);
window.addEventListener("hashchange", showLinkedSlide);

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && document.body.classList.contains("presenting")) restoreViewer();
});

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

  switch (event.key.toLowerCase()) {
    case "arrowleft":
    case "pageup":
      event.preventDefault();
      moveSlide(-1);
      break;
    case "arrowright":
    case "pagedown":
      event.preventDefault();
      moveSlide(1);
      break;
    case "n":
      if (!event.repeat) toggleNotes();
      break;
    case "f":
      if (!event.repeat && !document.body.classList.contains("presenting")) startPresentation();
      break;
    case "escape":
      if (document.body.classList.contains("presenting")) stopPresentation();
      else if (outline.classList.contains("outline-open")) setOutline(false);
      break;
  }
});

showLinkedSlide();
document.body.classList.add("enhanced");
