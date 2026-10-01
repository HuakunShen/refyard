/**
* | output |
* | --- |
* | "Service instance" |
*
* @param {Settings_Service_InstanceInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_service_instance: ((inputs?: Settings_Service_InstanceInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Service_InstanceInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Service_InstanceInputs = {};
