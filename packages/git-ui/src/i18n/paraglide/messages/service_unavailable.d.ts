/**
* | output |
* | --- |
* | "The local service is unavailable" |
*
* @param {Service_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const service_unavailable: ((inputs?: Service_UnavailableInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Service_UnavailableInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Service_UnavailableInputs = {};
