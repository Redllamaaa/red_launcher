// TODO: port to Rust — Mojang API, downloads, and Java toolchain management (from helios-core)
export const MojangRestAPI = {
  status: async () => ({ responseStatus: "ERROR", data: [] }),
  getDefaultStatuses: () => [],
  statusToHex: () => "#808080",
};
export const getServerStatus = async () => ({
  online: false,
  players: { online: 0, max: 0 },
});
export const RestResponseStatus = { SUCCESS: "SUCCESS", ERROR: "ERROR" };
export const isDisplayableError = () => false;
export const validateLocalFile = async () => true;
export const FullRepair = class {
  async verifyFiles() {}
  async download() {}
};
export const DistributionIndexProcessor = class {};
export const MojangIndexProcessor = class {};
export const downloadFile = async () => {};
