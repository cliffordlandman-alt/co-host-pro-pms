export const VARIABLES:string[];
export const TRIGGERS:string[];
export const DEFAULT_MESSAGE_TEMPLATES:any[];
export function renderGuestMessage(body:string,values:any):any;
export function scheduledMessage(template:any,booking:any,property?:any,now?:Date,context?:any):any;
