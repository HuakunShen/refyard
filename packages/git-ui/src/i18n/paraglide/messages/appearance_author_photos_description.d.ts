/**
* | output |
* | --- |
* | "Photos inside commit nodes: GitHub for noreply emails, Gravatar for other emails. Missing photos use initials. Turning this off stops photo requests." |
*
* @param {Appearance_Author_Photos_DescriptionInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_author_photos_description: ((inputs?: Appearance_Author_Photos_DescriptionInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Appearance_Author_Photos_DescriptionInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Appearance_Author_Photos_DescriptionInputs = {};
