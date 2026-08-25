let updateSelectedServerHandler = null;

export function setUpdateSelectedServerHandler(fn) {
  updateSelectedServerHandler = fn;
}

export async function callUpdateSelectedServer(serv) {
  if (updateSelectedServerHandler) {
    await updateSelectedServerHandler(serv);
  }
}
