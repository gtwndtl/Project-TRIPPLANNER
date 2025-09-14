import React, { useEffect, useState } from "react";
import { Modal, Rate, Input } from "antd";
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

const RateReviewModal: React.FC<Props> = ({
  open,
  onCancel,
  onSubmit,
  loading = false,
  tripId,
  tripName,
  initialRating = 0,
  initialReview = "",
}) => {
  const [rating, setRating] = useState<number>(initialRating);
  const [review, setReview] = useState<string>(initialReview);

  useEffect(() => {
    if (open) {
      setRating(initialRating);
      setReview(initialReview);
    }
  }, [open, initialRating, initialReview]);

  const handleOk = async () => {
    await onSubmit({ rating, review });
  };

  return (
    <Modal
      className="cupertino-review-modal"
      title={
        tripName
          ? `รีวิวทริป: ${tripName}${tripId ? ` (#${tripId})` : ""}`
          : "รีวิวทริปของคุณ"
      }
      open={open}
      onCancel={onCancel}
      footer={
        <div className="crm-footer">
          <button
            type="button"
            className="btn-secondary compact"
            onClick={onCancel}
          >
            ไว้ทีหลัง
          </button>
          <button
            type="button"
            className="btn-secondary compact primary"
            onClick={handleOk}
            disabled={rating < 1 || loading}
          >
            {loading ? "กำลังส่งรีวิว…" : "ส่งรีวิว"}
          </button>
        </div>
      }
      centered
      destroyOnClose
      maskClosable
    >
      <div className="crm-body center">
        <div className="crm-section">
          <label className="crm-label">ให้คะแนนความประทับใจ</label>
          <Rate value={rating} onChange={setRating} className="crm-rate" />
          <div className="crm-hint">แตะเลือก 1–5 ดาว (5 = ประทับใจมาก)</div>
        </div>

        <div className="crm-section">
          <label className="crm-label">เล่าความประทับใจ (ไม่บังคับ)</label>
          <div className="crm-field crm-textarea">
            <Input.TextArea
              value={review}
              onChange={(e) => setReview(e.target.value)}
              rows={3}
              maxLength={1000}
              showCount
              placeholder="บอกสั้น ๆ ว่าชอบอะไร หรืออยากให้เราปรับปรุงอะไรบ้าง"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default RateReviewModal;
