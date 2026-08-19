// TODO: port to Rust — real distribution index fetching/caching via helios-core's DistributionAPI
export const REMOTE_DISTRO_URL =
  "https://raw.githubusercontent.com/Redllamaaa/tsmplauncher/master/app/assets/distribution.json";

export const DistroAPI = {
  getDistribution: async () => ({
    servers: [],
    getServerById: (id) => null,
    rawDistribution: { rss: null },
  }),
  toggleDevMode: () => {},
  refreshDistributionOrFallback: async () => ({
    servers: [],
    getServerById: (id) => null,
    rawDistribution: { rss: null },
  }),
  isDevMode: () => false,
};
