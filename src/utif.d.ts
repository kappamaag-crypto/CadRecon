declare module 'utif' {
export function decode(buffer:ArrayBuffer):Array<{width:number;height:number;[key:string]:unknown}>;
export function decodeImage(buffer:ArrayBuffer,image:{width:number;height:number;[key:string]:unknown}):void;
export function toRGBA8(image:{width:number;height:number;[key:string]:unknown}):Uint8Array;
}