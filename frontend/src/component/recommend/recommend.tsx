import { useEffect, useState } from 'react';
import { GetAllLandmarks } from '../../services/https';
import { Carousel, message, Spin, Rate } from 'antd';
import { HeartOutlined } from '@ant-design/icons';
import './recommend.css';
import type { LandmarkInterface } from '../../interfaces/Landmark';

const Recommend = () => {
    const [landmarks, setLandmarks] = useState<LandmarkInterface[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchLandmarks = async () => {
            try {
                const data = await GetAllLandmarks();
                setLandmarks(data || []);
            } catch (error) {
                console.error('Error fetching landmarks:', error);
                message.error('เกิดข้อผิดพลาดในการดึงข้อมูลสถานที่');
            } finally {
                setLoading(false);
            }
        };

        fetchLandmarks();
    }, []);

    const topLandmarks = landmarks.slice(0, 6);

    return (
        <div className="carousel-recommend-wrapper">
            {loading ? (
                <Spin />
            ) : topLandmarks.length > 0 ? (
                <Carousel autoplay={{ dotDuration: true }} autoplaySpeed={5000}>
                    {topLandmarks.map((item) => (
                        <div key={item.ID}>
                            <div
                                className="carousel-slide"
                                style={{
                                    backgroundImage: `url(${item.ThumbnailURL || 'https://via.placeholder.com/800x400'})`,
                                }}
                            >
                                <div className="carousel-content-box">
                                    <div className="carousel-header">
                                        <strong>สถานที่แนะนำ</strong>
                                    </div>
                                    <div className="carousel-place-name">
                                        {item.Name ?? 'ไม่ระบุชื่อ'}
                                    </div>
                                    <div className="carousel-icons">
                                        <HeartOutlined className="carousel-icon" />
                                        <Rate allowHalf disabled defaultValue={4.5} style={{ fontSize: 16 }} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </Carousel>
            ) : (
                <p>ไม่พบสถานที่แนะนำ</p>
            )}
        </div>
    );
};

export default Recommend;
