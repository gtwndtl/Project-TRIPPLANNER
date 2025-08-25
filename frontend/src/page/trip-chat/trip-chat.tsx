// TripPlannerChat.tsx
import TripChat from "../../component/chat/chat";
import "./trip-chat.css";

const TripPlannerChat = () => {
  return (
    <div className="trip-chat">
      <div className="trip-chat-layout">
        {/* Sidebar */}
        <aside className="trip-sidebar">
          <h2 className="trip-sidebar-title">Trip Recommendations</h2>

          <div className="trip-recommendation">
            <div className="trip-reco-text">
              <p className="trip-reco-days">3 days in Paris</p>
              <p className="trip-reco-city">Paris</p>
              <p className="trip-reco-country">Paris, France</p>
            </div>
            <div
              className="trip-reco-thumb"
              style={{
                backgroundImage:
                  'url("https://lh3.googleusercontent.com/aida-public/AB6AXuDy5M-I5JfJVP4GxZRF8-nOHbMqsHQva2fXSAv20vw5dzGNDxW8HQHsZ_J3agMFhzWFuHh-b3QmfbmGV_bTm5Fc8O31rPfBL1I2bysv7iQ-kcNU0ZiwftH9coH4bGxe_EGP5z2tlf2LdANtF89zIUUzzznvWb25XxwP0UFOH7HZ4OQ1cC1OeUZJ7_1epSwEzfRv2RwVM8tL-wdXSrU9xVGNJq6fKJHqn7P18tCwQ_sZAGORAkL9MOqPXNKkDl0Nh1elpSC9z-BKXzE")',
              }}
            />
          </div>

          <div className="trip-recommendation">
            <div className="trip-reco-text">
              <p className="trip-reco-days">5 days in Rome</p>
              <p className="trip-reco-city">Rome</p>
              <p className="trip-reco-country">Rome, Italy</p>
            </div>
            <div
              className="trip-reco-thumb"
              style={{
                backgroundImage:
                  'url("https://lh3.googleusercontent.com/aida-public/AB6AXuAI3pout6Y20FfWt4X0uNrgAP8X8DrPOqiI130lbkQXzVEtKQaaaJKqIV5CwPFTHTDRIxMCbDC-voFvph4nZ6M13MW4jb7KBezYdIogsyqJ1q10K6gdkLiYhMB3yTGrZK0iHTgtPg9ZrM_9rYtB8UeOC7d5m7BCsi6yXMrMfqKEIZe5eW2A5zAD9id3N_TM1ZskVJBhpMQZAA1cYv0N4Fv1JZff6vSir_x41hd2fyZi43oCvNvA_xO4LHJcQqk1znrVYe_MDSP3zNU")',
              }}
            />
          </div>

          <div className="trip-recommendation">
            <div className="trip-reco-text">
              <p className="trip-reco-days">4 days in London</p>
              <p className="trip-reco-city">London</p>
              <p className="trip-reco-country">London, UK</p>
            </div>
            <div
              className="trip-reco-thumb"
              style={{
                backgroundImage:
                  'url("https://lh3.googleusercontent.com/aida-public/AB6AXuA3y4KwforKVen35zBnqyRIop4_UPZzO3U5CKWr2_3ZqQKxXzxKBJqXtWvham_lIV_q_KFtY4A8lDf_OWCzflYMk7JjsrVhNzv8oDPjdEikekn4FAplm0SnR3yDMZbzc66v65NAyZQ956Un8P0lCwxCMwph6KfPFb-8-BRNpIHrdm-8hO1yP2H-Y6lNWPoRBWzJ6jWb2mjc6Y1upWgseMpAYh_fYL8TA5NlgzuTseq2TORwvTJ-S8TNzg2d9rqj0dAg6F0RJiaov_Y")',
              }}
            />
          </div>

          <div
            className="trip-map"
            style={{
              backgroundImage:
                'url("https://lh3.googleusercontent.com/aida-public/AB6AXuAKJZcoswUcYkvkwfSvgHBoAAAvb__oAhjxMdcK69IAys_8n7jkpT6wcrYSNuFk4PUg2Ju6WAZwcV8srAzHTm_pYpyl_QSIm_G-X66w-gjWvRl0VDa6okb0HVi_yvHiYtUosIXlr1JFvFqSotPh1xjQk3Y87Khm_b-Y59PFteM5GBwSRx0xc05RbtDfo3P4qUY48e4BX0sHSQGs6VKxbZ_NGOo4Jmb4QSAAkeG4j1AGZb5gdE8k39HRPVhNELE6S5-iPcO2GI5uct4")',
            }}
          />
        </aside>

        {/* Chat */}
        <TripChat />
      </div>
    </div>
  );
};

export default TripPlannerChat;
