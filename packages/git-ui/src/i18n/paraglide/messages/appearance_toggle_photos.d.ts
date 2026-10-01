/**
* | output |
* | --- |
* | "Toggle author photos" |
*
* @param {Appearance_Toggle_PhotosInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_toggle_photos: ((inputs?: Appearance_Toggle_PhotosInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Appearance_Toggle_PhotosInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Appearance_Toggle_PhotosInputs = {};
