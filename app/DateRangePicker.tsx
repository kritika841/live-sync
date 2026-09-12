"use client";
import {useState} from "react";
import {CalendarDays, ChevronLeft, ChevronRight} from "lucide-react";
import {Modal} from "./Modal";
const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
export default function DateRangePicker({from,to,max,onApply}:{from:string;to:string;max:string;onApply:(from:string,to:string)=>void}) {
  const [open,setOpen]=useState(false), [start,setStart]=useState(from), [end,setEnd]=useState(to);
  const [month,setMonth]=useState(() => new Date((from || max)+"T12:00:00"));
  function choose(value:string) {if (!start || end) {setStart(value);setEnd("");} else if(value<start){setEnd(start);setStart(value);}else setEnd(value);}
  const first=new Date(month.getFullYear(),month.getMonth(),1), days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  return <div className="date-range-control"><span>Order date range</span><button type="button" onClick={()=>{setStart(from);setEnd(to);setMonth(new Date((from||max)+"T12:00:00"));setOpen(true);}}><CalendarDays size={16}/>{from && to ? `${from} — ${to}` : "Custom range"}</button>
    <Modal open={open} onClose={()=>setOpen(false)} title="Select date range"><div className="range-picker">
      <p>Select a start date, then an end date.</p><div className="range-month"><button aria-label="Previous month" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft size={18}/></button><strong>{month.toLocaleDateString("en-IN",{month:"long",year:"numeric"})}</strong><button aria-label="Next month" disabled={key(new Date(month.getFullYear(),month.getMonth()+1,1))>max} onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight size={18}/></button></div>
      <div className="range-grid">{["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><span key={d}>{d}</span>)}{Array.from({length:first.getDay()},(_,i)=><span key={`blank${i}`}/>)}{Array.from({length:days},(_,i)=>{const value=key(new Date(month.getFullYear(),month.getMonth(),i+1));return <button key={value} type="button" aria-label={value} aria-pressed={value===start||value===end} disabled={value>max} className={`${value===start||value===end ? "endpoint" : ""} ${start && end && value>start && value<end ? "in-range" : ""}`} onClick={()=>choose(value)}>{i+1}</button>;})}</div>
      <p aria-live="polite">{start || "Start date"} → {end || "Choose end date"}</p><footer><button onClick={()=>{onApply("","");setOpen(false);}}>Clear</button><button onClick={()=>setOpen(false)}>Cancel</button><button className="ops-primary" disabled={!start||!end} onClick={()=>{onApply(start,end);setOpen(false);}}>OK</button></footer>
    </div></Modal></div>;
}
