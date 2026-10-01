/**
* | output |
* | --- |
* | "not connected (incompatible service)" |
*
* @param {Conn_Not_Connected_IncompatibleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_not_connected_incompatible: ((inputs?: Conn_Not_Connected_IncompatibleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conn_Not_Connected_IncompatibleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conn_Not_Connected_IncompatibleInputs = {};
