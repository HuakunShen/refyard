/**
* | output |
* | --- |
* | "Implemented write operations: {ops}" |
*
* @param {Header_Write_Ops_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const header_write_ops_title: ((inputs: Header_Write_Ops_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Header_Write_Ops_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Header_Write_Ops_TitleInputs = {
    ops: NonNullable<unknown>;
};
