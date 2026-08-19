// NOTE FOR THIRD-PARTY
// REPLACE THIS CLIENT ID WITH YOUR APPLICATION ID.
// SEE https://github.com/dscalzi/HeliosLauncher/blob/master/docs/MicrosoftAuth.md
export const AZURE_CLIENT_ID = "8cfd1566-d58e-4f37-a609-ef86fd2ab1a8";

// Opcodes
export const MSFT_OPCODE = {
  OPEN_LOGIN: "MSFT_AUTH_OPEN_LOGIN",
  OPEN_LOGOUT: "MSFT_AUTH_OPEN_LOGOUT",
  REPLY_LOGIN: "MSFT_AUTH_REPLY_LOGIN",
  REPLY_LOGOUT: "MSFT_AUTH_REPLY_LOGOUT",
};

// Reply types for REPLY opcode.
export const MSFT_REPLY_TYPE = {
  SUCCESS: "MSFT_AUTH_REPLY_SUCCESS",
  ERROR: "MSFT_AUTH_REPLY_ERROR",
};

// Error types for ERROR reply.
export const MSFT_ERROR = {
  ALREADY_OPEN: "MSFT_AUTH_ERR_ALREADY_OPEN",
  NOT_FINISHED: "MSFT_AUTH_ERR_NOT_FINISHED",
};

export const SHELL_OPCODE = {
  TRASH_ITEM: "TRASH_ITEM",
};
