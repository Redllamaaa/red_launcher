let viewOnLoginSuccess = null;
let viewOnLoginCancel = null;
let viewOnCancel = null;
let viewCancelHandler = null;

export function setLoginOptionsViewOnLoginSuccess(v) {
  viewOnLoginSuccess = v;
}
export function getLoginOptionsViewOnLoginSuccess() {
  return viewOnLoginSuccess;
}

export function setLoginOptionsViewOnLoginCancel(v) {
  viewOnLoginCancel = v;
}
export function getLoginOptionsViewOnLoginCancel() {
  return viewOnLoginCancel;
}

export function setLoginOptionsViewOnCancel(v) {
  viewOnCancel = v;
}
export function getLoginOptionsViewOnCancel() {
  return viewOnCancel;
}

export function setLoginOptionsViewCancelHandler(v) {
  viewCancelHandler = v;
}
export function getLoginOptionsViewCancelHandler() {
  return viewCancelHandler;
}
