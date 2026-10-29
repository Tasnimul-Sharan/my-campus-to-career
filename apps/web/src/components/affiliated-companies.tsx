import type { ReactNode } from "react";
import styles from "./affiliated-companies.module.css";

const companies: { name: string; style: string; mark: ReactNode }[] = [
  {
    name: "northstar",
    style: "northstar",
    mark: (
      <path
        d="m20 2 4.4 12.4L37 20l-12.6 5.6L20 38l-4.4-12.4L3 20l12.6-5.6Z"
        fill="currentColor"
      />
    ),
  },
  {
    name: "Layers",
    style: "layers",
    mark: (
      <>
        <path d="m20 3 17 9-17 9L3 12Z" fill="currentColor" />
        <path
          d="m4 20 16 9 16-9M4 28l16 9 16-9"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  {
    name: "orbit",
    style: "orbit",
    mark: (
      <>
        <circle
          cx="20"
          cy="20"
          r="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
        <ellipse
          cx="20"
          cy="20"
          rx="19"
          ry="7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          transform="rotate(-35 20 20)"
        />
        <circle cx="31" cy="7" r="3.3" fill="currentColor" />
      </>
    ),
  },
  {
    name: "VERTEX",
    style: "vertex",
    mark: (
      <>
        <path
          d="M3 32 19 5l17 27H23L12 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path
          d="m20 25 4-7 8 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  {
    name: "bloom",
    style: "bloom",
    mark: (
      <>
        <path
          d="M20 20C3 22 1 3 12 4c8 0 8 10 8 16Zm0 0C18 3 37 1 36 12c0 8-10 8-16 8Zm0 0c17-2 19 17 8 16-8 0-8-10-8-16Zm0 0C22 37 3 39 4 28c0-8 10-8 16-8Z"
          fill="currentColor"
        />
      </>
    ),
  },
  {
    name: "LUMEN",
    style: "lumen",
    mark: (
      <>
        <path
          d="M20 3v8m0 18v8M3 20h8m18 0h8M8 8l6 6m12 12 6 6M8 32l6-6m12-12 6-6"
          stroke="currentColor"
          strokeWidth="3.3"
          strokeLinecap="round"
        />
        <circle cx="20" cy="20" r="5" fill="currentColor" />
      </>
    ),
  },
];

export function AffiliatedCompanies() {
  return (
    <section
      className={styles.section}
      id="affiliated-companies"
      aria-labelledby="affiliated-companies-title"
      aria-describedby="affiliated-companies-note"
    >
      <div className="container">
        <div className={styles.heading}>
          <div>
            <span className="eyebrow">AFFILIATED COMPANIES</span>
            <h2 id="affiliated-companies-title">
              Good teams.
              <br />
              <span>New possibilities.</span>
            </h2>
          </div>
          {/* <div className={styles.caption}>
            <span className={styles.sample}>
              <i aria-hidden="true" />
              Sample company logos
            </span>
            <p id="affiliated-companies-note">
              An illustrative preview of our company showcase.
            </p>
          </div> */}
        </div>
        <ul className={styles.logos} aria-label="Sample company logos">
          {companies.map((company) => (
            <li
              className={`${styles.logo} ${styles[company.style]}`}
              key={company.name}
            >
              <svg
                viewBox="0 0 40 40"
                width="40"
                height="40"
                aria-hidden="true"
                focusable="false"
              >
                {company.mark}
              </svg>
              <span>{company.name}</span>
            </li>
          ))}
        </ul>
        <div className={styles.footnote} aria-hidden="true">
          <span className={styles.line} />
          <span>FRESH PERSPECTIVES. SHARED POSSIBILITIES.</span>
          <span className={styles.line} />
        </div>
      </div>
    </section>
  );
}
