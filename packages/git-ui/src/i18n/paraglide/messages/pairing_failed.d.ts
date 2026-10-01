/**
* | output |
* | --- |
* | "Pairing failed" |
*
* @param {Pairing_FailedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pairing_failed: ((inputs?: Pairing_FailedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Pairing_FailedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Pairing_FailedInputs = {};
