// RateReviewModal.tsx
import React, { useEffect, useState } from "react";
import { Modal, Rate, Button } from "antd";
import "./review.css";

interface Props {
  open: boolean;
  onCancel: () => void;
  onSubmit: (val: { rating: number; review: string }) => Promise<void> | void;
  loading?: boolean;
  tripId?: number;           // เผื่อใช้ภายนอก
  tripName?: string;
  initialRating?: number;
  initialReview?: string;
}

const PHRASES = [
  "ทริปใช้งานได้จริง",
  "คุ้มค่า",
  "เดินทางง่าย",
  "วิวสวย",
  "อากาศดี",
  "อาหารอร่อย",
];

// ---------- helpers (pure) ----------
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasPhrase = (text: string, phrase: string) => {
  const re = new RegExp(`(^|\\s)${escapeRegex(phrase)}(\\s|$)`);
  return re.test(text.trim());
};
const normalizeSpaces = (s: string) => s.replace(/\s+/g, " ").trim();
const addPhrase = (text: string, phrase: string) => {
  if (!text || !text.trim()) return phrase;
  if (hasPhrase(text, phrase)) return normalizeSpaces(text);
  return normalizeSpaces(`${text} ${phrase}`);
};
const removePhrase = (text: string, phrase: string) => {
  if (!text) return "";
  const re = new RegExp(`(^|\\s)${escapeRegex(phrase)}(?=\\s|$)`, "g");
  const out = text.replace(re, "$1");
  return normalizeSpaces(out);
};

const RateReviewModal: React.FC<Props> = ({
  open,
  onCancel,
  onSubmit,
  loading = false,
  tripName,
  initialRating = 0,
  initialReview = "",
}) => {
  const [rating, setRating] = useState<number>(initialRating);
  const [review, setReview] = useState<string>(initialReview);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // reset เมื่อ modal เปิดใหม่
  useEffect(() => {
    if (open) {
      setRating(initialRating);
      setReview(initialReview);
      setSelected(new Set());
    }
  }, [open, initialRating, initialReview]);

  const togglePhrase = (label: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
        setReview((t) => removePhrase(t, label));
      } else {
        next.add(label);
        setReview((t) => addPhrase(t, label));
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading || rating < 1) return;
    await onSubmit({ rating, review });
  };

  return (
    <Modal
      className="cupertino-review-modal"
      open={open}
      onCancel={onCancel}
      footer={null}
      centered
      destroyOnClose
      maskClosable
      closable={false}
    >
      <div className="review-root">
        <div className="review-card">
          <form className="review-inner" onSubmit={handleSubmit}>
            <h2 className="review-title">{tripName ?? "รีวิวทริปของคุณ"}</h2>

            {/* Rating */}
            <div className="rating-block">
              <p className="rating-label">ให้คะแนนประสบการณ์ทริปนี้</p>
              <div className="rating-stars">
                <Rate value={rating} onChange={setRating} />
              </div>
            </div>

            {/* Chips */}
            <div className="section">
              <h3 className="section-title">คุณชอบอะไรในทริปนี้บ้าง?</h3>
              <div className="chips">
                {PHRASES.map((label) => {
                  const active = selected.has(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      className={`chip ${active ? "chip-active" : ""}`}
                      aria-pressed={active}
                      onClick={() => togglePhrase(label)}
                      disabled={loading}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Review */}
            <div className="section">
              <label className="section-title" htmlFor="review-text">
                เล่าประสบการณ์ทริปนี้
              </label>
              <textarea
                id="review-text"
                className="textarea"
                placeholder="เล่าเพิ่มเติมเกี่ยวกับทริปของคุณ..."
                rows={5}
                value={review}
                onChange={(e) => setReview(e.target.value)}
                disabled={loading}
              />
            </div>

            {/* Actions (AntD Buttons) */}
            <div className="actions">
              <Button onClick={onCancel} disabled={loading}>
                ยกเลิก
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                disabled={rating < 1}
                loading={loading}
              >
                ส่งรีวิวทริป
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Modal>
  );
};

export default RateReviewModal;
