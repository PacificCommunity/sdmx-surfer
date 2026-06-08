/**
 * INCLUDE_COUNTRY_SNAPSHOTS is read at build/runtime to decide whether
 * the snapshots module surfaces are exposed. Default ON in MFAT
 * deployments, OFF when shipping a snapshot-free Surfer.
 */
export const countrySnapshotsEnabled =
  process.env.INCLUDE_COUNTRY_SNAPSHOTS !== "0";
