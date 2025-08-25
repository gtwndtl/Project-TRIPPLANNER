import TripChat from "../../component/chat/chat";
import TripRecommendations from "../../component/recommend/recommend";
import "./trip-chat.css";

const TripPlannerChat = () => {
  return (
    <div className="trip-chat">
      <div className="trip-chat-layout">
        {/* Sidebar (แยกเป็นคอมโพเนนต์แล้ว) */}
        <TripRecommendations />
        {/* Chat */}
        <TripChat />
      </div>
    </div>
  );
};

export default TripPlannerChat;
