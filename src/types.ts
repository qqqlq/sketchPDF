export type ToolId = 'select' | 'text' | 'image' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'pen' | 'hl';
export type Align = 'left' | 'center' | 'right';
export type Pt = [number, number];

export interface TextObj {
  id: string; type: 'text'; x: number; y: number; text: string;
  fs: number; color: string; align: Align; bold: boolean; bg: string | null; op: number;
  w?: number; h?: number;   // 画面上の実測サイズ(書き出しでは使わない)
}
export interface ImageObj {
  id: string; type: 'image'; asset: string; x: number; y: number; w: number; h: number; op: number;
}
export interface ShapeObj {
  id: string; type: 'rect' | 'ellipse' | 'hl'; x: number; y: number; w: number; h: number;
  fill: string | null; stroke: string; sw: number; op: number;
}
export interface LineObj {
  id: string; type: 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number;
  stroke: string; sw: number; op: number;
}
export interface PenObj {
  id: string; type: 'pen'; pts: Pt[]; stroke: string; sw: number; op: number;
}
export type Obj = TextObj | ImageObj | ShapeObj | LineObj | PenObj;
export type ObjType = Obj['type'];

/** 1ページ。src=-1 は空白ページ。座標は「回転適用後の表示向き・pt・左上原点」 */
export interface Page {
  id: string; src: number; num: number;
  r0: number; rot: number; w0: number; h0: number;
  box: number[] | null;
  objs: Obj[];
}

export interface Sel { pid: string; oid: string }

/** 次に作るオブジェクトの既定値(プロパティパネルの変更が引き継がれる) */
export type Defaults = {
  text: Omit<TextObj, 'id' | 'type' | 'x' | 'y' | 'text' | 'w' | 'h'>;
  rect: Omit<ShapeObj, 'id' | 'type' | 'x' | 'y' | 'w' | 'h'>;
  ellipse: Omit<ShapeObj, 'id' | 'type' | 'x' | 'y' | 'w' | 'h'>;
  hl: Omit<ShapeObj, 'id' | 'type' | 'x' | 'y' | 'w' | 'h'>;
  line: Omit<LineObj, 'id' | 'type' | 'x1' | 'y1' | 'x2' | 'y2'>;
  arrow: Omit<LineObj, 'id' | 'type' | 'x1' | 'y1' | 'x2' | 'y2'>;
  pen: Omit<PenObj, 'id' | 'type' | 'pts'>;
  image: { op: number };
};

export const isLine = (o: Obj): o is LineObj => o.type === 'line' || o.type === 'arrow'
export const isShape = (o: Obj): o is ShapeObj => o.type === 'rect' || o.type === 'ellipse' || o.type === 'hl'
