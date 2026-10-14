import { createApp } from "vue";
import App from "./App.vue";
import OverviewApp from "./OverviewApp.vue";
import "./styles.css";

// 모아보기 창은 같은 화면 묶음을 #overview로 연다
// 작은 창이 보던 날짜를 #overview?date=... 로 붙여 보내므로 앞부분만 비교한다
createApp(location.hash.startsWith("#overview") ? OverviewApp : App).mount("#app");
