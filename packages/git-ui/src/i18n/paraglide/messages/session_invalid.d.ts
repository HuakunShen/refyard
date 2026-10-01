/**
* | output |
* | --- |
* | "The session is no longer valid" |
*
* @param {Session_InvalidInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const session_invalid: ((inputs?: Session_InvalidInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Session_InvalidInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Session_InvalidInputs = {};
