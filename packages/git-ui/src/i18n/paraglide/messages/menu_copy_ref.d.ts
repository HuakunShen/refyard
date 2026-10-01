/**
* | output |
* | --- |
* | "Copy {ref}" |
*
* @param {Menu_Copy_RefInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_copy_ref: ((inputs: Menu_Copy_RefInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Menu_Copy_RefInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Menu_Copy_RefInputs = {
    ref: NonNullable<unknown>;
};
