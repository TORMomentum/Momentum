import { useState } from "react";
import styles from "./admin.module.css";

/**
 * One page of the stored original with the place a value was read boxed on it
 * (TOR-128). Boxes are fractions of the page, so they sit right at any size.
 * A page image that fails to load says so; the reviewer still has the PDF.
 */
export function PageBoxes({
  src,
  label,
  boxes,
}: {
  src: string;
  label: string;
  boxes: Array<[number, number, number, number]>;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <p className={styles.adminDocError}>ไม่พบภาพหน้าเอกสาร — ดูต้นฉบับ PDF แทน</p>;
  }
  return (
    <div className={styles.adminPage}>
      {/* A stored derived image, streamed through the proxy: no image optimisation. */}
      <img src={src} alt={`หน้าเอกสาร: ${label}`} className={styles.adminPageImage} onError={() => setFailed(true)} />
      {boxes.map(([x0, y0, x1, y1], index) => (
        <span
          key={index}
          data-testid="source-box"
          className={styles.adminPageBox}
          style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
        />
      ))}
    </div>
  );
}
