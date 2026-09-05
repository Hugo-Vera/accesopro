"use client";

import React, { useState, useEffect, useRef } from "react";
import { Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock, Check } from "lucide-react";

interface DahuaDateTimePickerProps {
  value: string; // Format: "YYYY-MM-DD HH:mm:ss"
  onChange: (val: string) => void;
  disabled?: boolean;
}

const MONTH_NAMES = [
  "ene.", "feb.", "mar.", "abr.", "may.", "jun.",
  "jul.", "ago.", "sep.", "oct.", "nov.", "dic."
];

const WEEKDAYS = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];

export function DahuaDateTimePicker({ value, onChange, disabled }: DahuaDateTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse current value or fallback
  const parseDateTime = (str: string) => {
    try {
      const parts = str.trim().split(" ");
      const [year, month, day] = (parts[0] || "").split("-").map(Number);
      const [hours, mins, secs] = (parts[1] || "").split(":").map(Number);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        return {
          year: year || 2037,
          month: (month ? month - 1 : 11),
          day: day || 31,
          hours: !isNaN(hours) ? hours : 23,
          minutes: !isNaN(mins) ? mins : 59,
          seconds: !isNaN(secs) ? secs : 59,
        };
      }
    } catch {}
    return { year: 2037, month: 11, day: 31, hours: 23, minutes: 59, seconds: 59 };
  };

  const parsed = parseDateTime(value);
  const [viewYear, setViewYear] = useState(parsed.year);
  const [viewMonth, setViewMonth] = useState(parsed.month);
  const [selectedDay, setSelectedDay] = useState(parsed.day);
  const [selectedHour, setSelectedHour] = useState(parsed.hours);
  const [selectedMinute, setSelectedMinute] = useState(parsed.minutes);
  const [selectedSecond, setSelectedSecond] = useState(parsed.seconds);

  // Sync state when value changes externally
  useEffect(() => {
    const p = parseDateTime(value);
    setViewYear(p.year);
    setViewMonth(p.month);
    setSelectedDay(p.day);
    setSelectedHour(p.hours);
    setSelectedMinute(p.minutes);
    setSelectedSecond(p.seconds);
  }, [value]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const pad = (n: number) => n.toString().padStart(2, "0");

  const formatOutput = (y: number, m: number, d: number, h: number, min: number, s: number) => {
    return `${y}-${pad(m + 1)}-${pad(d)} ${pad(h)}:${pad(min)}:${pad(s)}`;
  };

  const handleNow = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    const h = now.getHours();
    const min = now.getMinutes();
    const s = now.getSeconds();
    setViewYear(y);
    setViewMonth(m);
    setSelectedDay(d);
    setSelectedHour(h);
    setSelectedMinute(min);
    setSelectedSecond(s);
  };

  const handleApply = () => {
    const valStr = formatOutput(viewYear, viewMonth, selectedDay, selectedHour, selectedMinute, selectedSecond);
    onChange(valStr);
    setIsOpen(false);
  };

  // Calendar matrix calculations
  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const firstDayOfMonth = (y: number, m: number) => {
    const d = new Date(y, m, 1).getDay();
    return d === 0 ? 6 : d - 1; // 0 = Monday, 6 = Sunday
  };

  const totalDays = daysInMonth(viewYear, viewMonth);
  const startOffset = firstDayOfMonth(viewYear, viewMonth);
  const prevMonthTotal = daysInMonth(viewYear, viewMonth - 1);

  const prevMonthDays = Array.from({ length: startOffset }, (_, i) => prevMonthTotal - startOffset + i + 1);
  const currentMonthDays = Array.from({ length: totalDays }, (_, i) => i + 1);
  const remaining = (7 - ((prevMonthDays.length + currentMonthDays.length) % 7)) % 7;
  const nextMonthDays = Array.from({ length: remaining }, (_, i) => i + 1);

  const handlePrevYear = () => setViewYear((y) => y - 1);
  const handleNextYear = () => setViewYear((y) => y + 1);
  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  return (
    <div className="relative inline-block w-full" ref={containerRef}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          disabled={disabled}
          value={value || "2037-12-31 23:59:59"}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className="w-full bg-[#0e1626] border border-[#2b354c] rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-cyan-500 cursor-pointer disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className="px-3 py-2 bg-[#1b263b] hover:bg-[#253450] text-cyan-400 border border-[#2b354c] rounded-lg transition-colors disabled:opacity-50"
          title="Abrir calendario"
        >
          <Calendar className="w-4 h-4" />
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 right-0 sm:left-0 w-[360px] bg-[#111827] border border-[#374151] rounded-xl shadow-2xl p-4 text-slate-200">
          {/* Header with Year / Month navigation */}
          <div className="flex items-center justify-between pb-3 border-b border-[#1f2937]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevYear}
                className="p-1 hover:bg-[#1f2937] text-slate-400 hover:text-white rounded"
                title="Año anterior"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1 hover:bg-[#1f2937] text-slate-400 hover:text-white rounded"
                title="Mes anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            <div className="font-semibold text-sm text-slate-100">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1 hover:bg-[#1f2937] text-slate-400 hover:text-white rounded"
                title="Mes siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNextYear}
                className="p-1 hover:bg-[#1f2937] text-slate-400 hover:text-white rounded"
                title="Año siguiente"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-3 pt-3">
            {/* Calendar Days (7 cols) */}
            <div className="col-span-7 pr-2 border-r border-[#1f2937]">
              {/* Day headers */}
              <div className="grid grid-cols-7 text-center text-xs font-semibold text-slate-400 mb-2">
                {WEEKDAYS.map((wd) => (
                  <div key={wd} className="py-1">{wd}</div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-1 text-center text-xs">
                {prevMonthDays.map((d) => (
                  <div key={`prev-${d}`} className="py-1 text-slate-600 cursor-default">
                    {d}
                  </div>
                ))}
                {currentMonthDays.map((d) => {
                  const isSelected = d === selectedDay;
                  return (
                    <button
                      key={`curr-${d}`}
                      type="button"
                      onClick={() => setSelectedDay(d)}
                      className={`py-1 rounded font-medium transition-colors ${
                        isSelected
                          ? "bg-cyan-600 text-white font-bold shadow"
                          : "hover:bg-[#1f2937] text-slate-200"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
                {nextMonthDays.map((d) => (
                  <div key={`next-${d}`} className="py-1 text-slate-600 cursor-default">
                    {d}
                  </div>
                ))}
              </div>
            </div>

            {/* Time Selectors (5 cols) */}
            <div className="col-span-5 flex flex-col justify-between">
              <div className="text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-cyan-400" /> Horario
              </div>

              <div className="grid grid-cols-3 gap-1 bg-[#0b0f17] border border-[#1f2937] rounded-lg p-1.5 text-center">
                {/* Hours */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 pb-1">Hora</span>
                  <select
                    value={selectedHour}
                    onChange={(e) => setSelectedHour(Number(e.target.value))}
                    className="bg-[#111827] border border-[#374151] rounded text-xs text-white p-1 text-center font-mono focus:outline-none focus:border-cyan-500"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{pad(i)}</option>
                    ))}
                  </select>
                </div>

                {/* Minutes */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 pb-1">Min</span>
                  <select
                    value={selectedMinute}
                    onChange={(e) => setSelectedMinute(Number(e.target.value))}
                    className="bg-[#111827] border border-[#374151] rounded text-xs text-white p-1 text-center font-mono focus:outline-none focus:border-cyan-500"
                  >
                    {Array.from({ length: 60 }, (_, i) => (
                      <option key={i} value={i}>{pad(i)}</option>
                    ))}
                  </select>
                </div>

                {/* Seconds */}
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 pb-1">Seg</span>
                  <select
                    value={selectedSecond}
                    onChange={(e) => setSelectedSecond(Number(e.target.value))}
                    className="bg-[#111827] border border-[#374151] rounded text-xs text-white p-1 text-center font-mono focus:outline-none focus:border-cyan-500"
                  >
                    {Array.from({ length: 60 }, (_, i) => (
                      <option key={i} value={i}>{pad(i)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Current preview */}
              <div className="bg-[#0b0f17] border border-[#1f2937] rounded p-1.5 text-center font-mono text-[11px] text-cyan-300 mt-2">
                {formatOutput(viewYear, viewMonth, selectedDay, selectedHour, selectedMinute, selectedSecond)}
              </div>
            </div>
          </div>

          {/* Footer Action buttons */}
          <div className="flex items-center justify-between pt-3 mt-3 border-t border-[#1f2937]">
            <button
              type="button"
              onClick={handleNow}
              className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              Ahora
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-3 py-1 text-xs text-slate-400 hover:text-white rounded hover:bg-[#1f2937]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs rounded-lg transition-colors shadow flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" /> Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
