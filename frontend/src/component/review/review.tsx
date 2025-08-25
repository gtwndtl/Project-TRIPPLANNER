import React, { useEffect, useState } from "react";
import { Modal, Rate, Input, Form } from "antd";

interface Props {
  open: boolean;
  onCancel: () => void;
  onSubmit: (val: { rating: number; review: string }) => Promise<void> | void;
  loading?: boolean;
  tripName?: string;
  initialRating?: number;
  initialReview?: string;
}

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
      title={tripName ? `ให้คะแนนทริป: ${tripName}` : "ให้คะแนนทริป"}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText="ส่งคะแนน"
      cancelText="ยกเลิก"
      okButtonProps={{ disabled: rating < 1, loading }}
      centered
      getContainer={() => document.body}
      destroyOnClose
    >
      <Form layout="vertical">
        <Form.Item label="ให้ดาว">
          <Rate value={rating} onChange={setRating} />
        </Form.Item>
        <Form.Item label="รีวิว (ไม่บังคับ)">
          <Input.TextArea
            value={review}
            onChange={(e) => setReview(e.target.value)}
            rows={4}
            maxLength={1000}
            showCount
            placeholder="เล่าให้หน่อยว่าทริปนี้เป็นยังไงบ้าง…"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default RateReviewModal;
