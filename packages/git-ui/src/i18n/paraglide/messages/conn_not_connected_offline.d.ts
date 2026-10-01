/**
* | output |
* | --- |
* | "not connected (offline)" |
*
* @param {Conn_Not_Connected_OfflineInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_not_connected_offline: ((inputs?: Conn_Not_Connected_OfflineInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conn_Not_Connected_OfflineInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conn_Not_Connected_OfflineInputs = {};
