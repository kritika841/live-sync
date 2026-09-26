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
  return (
    <div className="date-range-control flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Order date range</span>
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 text-xs font-medium text-foreground hover:bg-muted transition outline-none shadow-sm"
        onClick={()=>{setStart(from);setEnd(to);setMonth(new Date((from||max)+"T12:00:00"));setOpen(true);}}
      >
        <CalendarDays size={15} className="text-muted-foreground shrink-0"/>
        <span className="truncate">{from && to ? `${from} — ${to}` : "Custom range"}</span>
      </button>
      <Modal open={open} onClose={()=>setOpen(false)} title="Select date range">
        <div className="range-picker space-y-3 p-1">
          <p className="text-xs text-muted-foreground">Select a start date, then an end date.</p>
          <div className="range-month flex items-center justify-between py-1">
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-muted"
              aria-label="Previous month"
              onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}
            >
              <ChevronLeft size={16}/>
            </button>
            <strong className="text-sm font-semibold text-foreground">
              {month.toLocaleDateString("en-IN",{month:"long",year:"numeric"})}
            </strong>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-muted disabled:opacity-30"
              aria-label="Next month"
              disabled={key(new Date(month.getFullYear(),month.getMonth()+1,1))>max}
              onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}
            >
              <ChevronRight size={16}/>
            </button>
          </div>
          <div className="range-grid">
            {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><span key={d} className="text-xs font-semibold text-muted-foreground py-1">{d}</span>)}
            {Array.from({length:first.getDay()},(_,i)=><span key={`blank${i}`}/>)}
            {Array.from({length:days},(_,i)=>{
              const value=key(new Date(month.getFullYear(),month.getMonth(),i+1));
              return (
                <button
                  key={value}
                  type="button"
                  aria-label={value}
                  aria-pressed={value===start||value===end}
                  disabled={value>max}
                  className={`size-9 rounded-lg text-xs font-medium transition ${
                    value===start||value===end
                      ? "endpoint bg-primary text-primary-foreground font-bold shadow-sm"
                      : start && end && value>start && value<end
                      ? "in-range bg-accent text-accent-foreground font-semibold"
                      : "text-foreground hover:bg-muted"
                  } disabled:opacity-25`}
                  onClick={()=>choose(value)}
                >
                  {i+1}
                </button>
              );
            })}
          </div>
          <p aria-live="polite" className="text-xs font-medium text-foreground py-1">
            {start || "Start date"} → {end || "Choose end date"}
          </p>
          <footer className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition"
              onClick={()=>{onApply("","");setOpen(false);}}
            >
              Clear
            </button>
            <button
              type="button"
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition"
              onClick={()=>setOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ops-primary rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition disabled:opacity-50"
              disabled={!start||!end}
              onClick={()=>{onApply(start,end);setOpen(false);}}
            >
              Apply
            </button>
          </footer>
        </div>
      </Modal>
    </div>
  );
}
