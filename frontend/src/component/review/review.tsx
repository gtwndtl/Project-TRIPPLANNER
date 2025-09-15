// RateReviewModal.tsx
import React, { useEffect, useState } from "react";
import { Modal, Rate } from "antd";
import "./review.css";

interface Props {
  open: boolean;
  onCancel: () => void;
  onSubmit: (val: { rating: number; review: string }) => Promise<void> | void;
  loading?: boolean;
  tripId?: number;
  tripName?: string;
  initialRating?: number;
  initialReview?: string;
}

// คำไทยตามบริบททริป
const loveOptions = [
  "ทริปใช้งานได้จริง",
  "คุ้มค่า",
  "เดินทางง่าย",
  "วิวสวย",
  "อากาศดี",
  "อาหารอร่อย",
];

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
  const [story, setStory] = useState<string>(initialReview);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setRating(initialRating);
      setStory(initialReview);
      setSelected(new Set());
    }
  }, [open, initialRating, initialReview]);

  // ===== Helpers: เพิ่ม/ลบ phrase ด้วยการคั่น "ช่องว่าง" =====
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

  const handleToggle = (label: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
        setStory((t) => removePhrase(t, label));   // unselect → ลบออก
      } else {
        next.add(label);
        setStory((t) => addPhrase(t, label));      // select → เติมเข้าไป
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || rating < 1) return;
    await onSubmit({ rating, review: story });
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
      {/* ▼ UI เดิม (เปลี่ยนเฉพาะส่วนดาวให้เป็น AntD Rate) ▼ */}
      <div className="review-root">
        <div className="review-card">
          <form className="review-inner" onSubmit={handleSubmit}>
            <h2 className="review-title">
              {tripName ? `${tripName}` : "รีวิวทริปของคุณ"}
            </h2>

            {/* Rating (Ant Design Rate) */}
            <div className="rating-block">
              <p className="rating-label">ให้คะแนนประสบการณ์ทริปนี้</p>
              <div className="rating-stars">
                <Rate
                  value={rating}
                  onChange={setRating}
                  className="ant-rate-custom"
                />
              </div>
            </div>

            <div className="mb-6 section">
              <h3 className="section-title">คุณชอบอะไรในทริปนี้บ้าง?</h3>
              <div className="chips flex flex-wrap gap-2">
                {loveOptions.map((label) => {
                  const isActive = selected.has(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      className={`chip ${isActive ? "chip-active" : ""}`}
                      aria-pressed={isActive}
                      onClick={() => handleToggle(label)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="section">
              <label className="section-title mb-2 block" htmlFor="review-text">
                เล่าประสบการณ์ทริปนี้
              </label>
              <textarea
                className="textarea form-textarea w-full rounded-lg border-gray-300 bg-gray-50 text-gray-800 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                id="review-text"
                placeholder="เล่าเพิ่มเติมเกี่ยวกับทริปของคุณ..."
                rows={5}
                value={story}
                onChange={(e) => setStory(e.target.value)}
              />
            </div>

            <div className="actions mt-8 flex justify-end">
              <button className="btn-primary flex items-center justify-center rounded-lg bg-primary-600 px-6 py-3 text-base font-bold text-white shadow-md transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2">
                ส่งรีวิวทริป
              </button>
            </div>
          </form>
        </div>
      </div>
    </Modal>
  );
};

export default RateReviewModal;
