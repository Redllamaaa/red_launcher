let updateSelectedServerHandler = null;

export function setUpdateSelectedServerHandler(fn) {
  updateSelectedServerHandler = fn;
}

export function callUpdateSelectedServer(serv) {
  if (updateSelectedServerHandler) {
    updateSelectedServerHandler(serv);
  }
}
