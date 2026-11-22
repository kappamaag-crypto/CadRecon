import {useMemo,useState} from 'react';
import type {Tool} from './model';

export interface PaletteTool {id:Tool;title:string;icon:string;hotkey?:string}
interface Props {tools:PaletteTool[];active:Tool;onSelect:(tool:Tool)=>void;selection:boolean}
const groups:{title:string;hint:string;ids:Tool[]}[]=[
  {title:'Навигация',hint:'Выбор и перемещение',
    ids:['select','pan']},
  {title:'Вспомогательная геометрия',hint:'Не попадает в DXF/печать',
    ids:['construction-h','construction-v','construction-line','construction-bisector','axis']},
  {title:'Геометрия и контуры',hint:'Отрезки, окружности, кривые, многоугольники',
    ids:['point','line','line-dashed','polyline','rectangle','rect-center','circle',
      'circle-3pt','ellipse','polygon-inscribed','polygon-circumscribed','arc','arc-3pt','bezier']},
  {title:'Правка и сопряжения',hint:'Ручное редактирование с Undo',
    ids:['trim','extend','offset','break','join','chamfer','fillet','stretch','mirror']},
  {title:'Размеры и измерения',hint:'Значения требуют калибровки',
    ids:['dimension','dimension-h','dimension-v','dimension-3pt','leader','measure','measure-angle','calibrate']},
  {title:'Оформление и ЕСКД',hint:'Отметки, текст, таблицы',
    ids:['hatch','text','technical-requirements','table','stamp','eskd']},
  {title:'Текст и OCR',hint:'Обработка на вашем устройстве',
    ids:['ocr-region']},
];
const requiresSelection=new Set<Tool>(['stretch','mirror']);
export default function CadPalette({tools,active,onSelect,selection}:Props){
  const [query,setQuery]=useState(''),[pins,setPins]=useState<Tool[]>([]);
  const index=useMemo(()=>new Map(tools.map(t=>[t.id,t])),[tools]);
  const normalized=query.trim().toLocaleLowerCase('ru-RU');
  const visible=(entry:PaletteTool)=>entry.title.toLocaleLowerCase('ru-RU').includes(normalized)
    ||entry.id.toLowerCase().includes(normalized);
  const listed=groups.map(g=>({...g,items:g.ids.map(id=>index.get(id)).filter(
    (x):x is PaletteTool=>!!x&&(!normalized||visible(x)))})).filter(g=>g.items.length);
  const button=(t:PaletteTool)=>(
    <div className="cad-command" key={t.id}>
      <button type="button" className={'cad-command-main'+(active===t.id?' active':'')}
        disabled={requiresSelection.has(t.id)&&!selection}
        aria-label={'Команда: '+t.title}
        onClick={()=>{onSelect(t.id);setQuery('');}}>
        <span className="cad-command-icon">{t.icon}</span>
        <span>{t.title}</span>
        {t.hotkey&&<kbd>{t.hotkey}</kbd>}
      </button>
      <button className={'cad-pin'+(pins.includes(t.id)?' active':'')} type="button"
        aria-label={(pins.includes(t.id)?'Убрать из избранного: ':'Закрепить в избранном: ')+t.title}
        title="Быстрый доступ" onClick={()=>setPins(s=>s.includes(t.id)?s.filter(id=>id!==t.id):[...s,t.id])}>
        {pins.includes(t.id)?'★':'☆'}
      </button>
    </div>);
  return <div className="cad-palette">
    <label htmlFor="cad-command-search" className="cad-search-label">Поиск CAD-команды <kbd>Ctrl+K</kbd></label>
    <input id="cad-command-search" type="search" autoComplete="off" value={query}
      onChange={e=>setQuery(e.target.value)}
      placeholder="Линия, размер, осевая, эллипс…" aria-label="Поиск CAD-команды"/>
    <p className="cad-palette-hint">Выберите группу или введите название. ★ — избранные команды.
      Esc отменяет построение.</p>
    {pins.length>0&&<details className="cad-tool-group" open={!!normalized}>
      <summary><span>★ Избранные</span><small>{pins.length}</small></summary>
      <div className="cad-command-list">{pins.map(x=>index.get(x)).filter(
        (x):x is PaletteTool=>!!x&&(!normalized||visible(x))).map(button)}</div>
    </details>}
    {listed.length===0&&<p className="muted">Команды не найдены. Попробуйте другое слово.</p>}
    {listed.map(group=><details className="cad-tool-group" key={group.title} open={!!normalized}>
      <summary><span>{group.title}</span><small>{group.items.length}</small></summary>
      <p className="cad-group-hint">{group.hint}</p>
      <div className="cad-command-list">{group.items.map(button)}</div>
    </details>)}
  </div>;
}
