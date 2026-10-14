import { createApp } from "vue";
import App from "./App.vue";
import OverviewApp from "./OverviewApp.vue";
import "./styles.css";

// 모아보기 창은 같은 화면 묶음을 #overview로 연다
createApp(location.hash === "#overview" ? OverviewApp : App).mount("#app");
