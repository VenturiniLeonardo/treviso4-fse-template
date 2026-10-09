import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Composizione delle classi Tailwind, convenzione shadcn/ui. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
