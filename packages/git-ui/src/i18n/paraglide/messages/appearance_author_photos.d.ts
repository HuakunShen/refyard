/**
* | output |
* | --- |
* | "Author Photos" |
*
* @param {Appearance_Author_PhotosInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_author_photos: ((inputs?: Appearance_Author_PhotosInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Appearance_Author_PhotosInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Appearance_Author_PhotosInputs = {};
