import $ from "jquery";

let currentView;

function setCurrentView(view) {
  currentView = view;
}

function getCurrentView() {
  return currentView;
}

function switchView(
  current,
  next,
  currentFadeTime = 500,
  nextFadeTime = 500,
  onCurrentFade = () => {},
  onNextFade = () => {},
) {
  setCurrentView(next);
  $(`${current}`).fadeOut(currentFadeTime, async () => {
    await onCurrentFade();
    $(`${next}`).fadeIn(nextFadeTime, async () => {
      await onNextFade();
    });
  });
}

export { getCurrentView, setCurrentView, switchView };
