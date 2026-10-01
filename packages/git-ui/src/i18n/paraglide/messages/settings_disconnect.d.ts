/**
* | output |
* | --- |
* | "Disconnect" |
*
* @param {Settings_DisconnectInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_disconnect: ((inputs?: Settings_DisconnectInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_DisconnectInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_DisconnectInputs = {};
