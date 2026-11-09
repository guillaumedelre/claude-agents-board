import type { SVGProps } from "react"

// Robot head (lucide Bot) whose antenna is a Claude-style spark.
export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="16" height="11" x="4" y="9" rx="2.5" />
      <path d="M2 14.5h2M20 14.5h2M15 13.5v2M9 13.5v2" />
      <path stroke="#d97757" d="M12 9V1M8.5 4.5h7M9.53 2.03l4.94 4.94M14.47 2.03l-4.94 4.94" />
    </svg>
  )
}
