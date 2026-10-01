/**
* | output |
* | --- |
* | "Pair again" |
*
* @param {Pairing_AgainInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pairing_again: ((inputs?: Pairing_AgainInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Pairing_AgainInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Pairing_AgainInputs = {};
