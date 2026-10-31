import { describe, expect, it } from "vitest";
import { folderLabel } from "./folderLabel";

const home = "/Users/me";

describe("folderLabel", () => {
  it("기본 폴더는 긴 컨테이너 경로 대신 이름으로 보이고, 전체 경로는 title로 남긴다", () => {
    const path = "/Users/me/Library/Containers/dev.aruu.aru/Data/Library/Application Support/dev.aruu.aru";
    expect(folderLabel({ path, isDefault: true, home })).toEqual({ label: "기본 폴더 (Aru 안)", title: path });
  });

  it("고른 폴더는 홈 폴더를 ~로 줄인다", () => {
    expect(folderLabel({ path: "/Users/me/Dropbox/todo", isDefault: false, home })).toEqual({
      label: "~/Dropbox/todo",
      title: "/Users/me/Dropbox/todo",
    });
    expect(folderLabel({ path: "/Users/me", isDefault: false, home: "/Users/me/" }).label).toBe("~");
  });

  it("iCloud Drive 폴더는 iCloud Drive로 보인다", () => {
    const path = "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/할 일";
    expect(folderLabel({ path, isDefault: false, home }).label).toBe("iCloud Drive/할 일");
  });

  it("홈 밖이거나 이름만 같은 폴더는 그대로 둔다", () => {
    expect(folderLabel({ path: "/Volumes/USB/todo", isDefault: false, home }).label).toBe("/Volumes/USB/todo");
    expect(folderLabel({ path: "/Users/meow/todo", isDefault: false, home }).label).toBe("/Users/meow/todo");
    expect(folderLabel({ path: "/Users/me/todo", isDefault: false, home: "" }).label).toBe("/Users/me/todo");
  });

  describe("Windows", () => {
    const win = "C:\\Users\\me";

    it("홈 폴더를 ~로 줄이고 \\로 잇는다", () => {
      expect(folderLabel({ path: "C:\\Users\\me\\Dropbox\\todo", isDefault: false, home: win }, "windows")).toEqual({
        label: "~\\Dropbox\\todo",
        title: "C:\\Users\\me\\Dropbox\\todo",
      });
      expect(folderLabel({ path: win, isDefault: false, home: "C:\\Users\\me\\" }, "windows").label).toBe("~");
    });

    it("/로 적힌 경로도 \\로 보인다", () => {
      expect(folderLabel({ path: "C:/Users/me/Dropbox/todo", isDefault: false, home: win }, "windows").label).toBe("~\\Dropbox\\todo");
    });

    it("OneDrive 폴더는 OneDrive로 보인다", () => {
      expect(folderLabel({ path: "C:\\Users\\me\\OneDrive\\할일", isDefault: false, home: win }, "windows").label).toBe("OneDrive\\할일");
      expect(folderLabel({ path: "C:\\Users\\me\\OneDrive", isDefault: false, home: win }, "windows").label).toBe("OneDrive");
    });

    it("홈 밖이거나 이름만 같은 폴더는 그대로 둔다", () => {
      expect(folderLabel({ path: "D:\\todo", isDefault: false, home: win }, "windows").label).toBe("D:\\todo");
      expect(folderLabel({ path: "C:\\Users\\meow\\todo", isDefault: false, home: win }, "windows").label).toBe("C:\\Users\\meow\\todo");
      expect(folderLabel({ path: "C:\\Users\\me\\OneDriveX\\todo", isDefault: false, home: win }, "windows").label).toBe("~\\OneDriveX\\todo");
    });

    it("기본 폴더는 이름으로 보인다", () => {
      const path = "C:\\Users\\me\\Documents\\Aru";
      expect(folderLabel({ path, isDefault: true, home: win }, "windows")).toEqual({ label: "기본 폴더 (Aru 안)", title: path });
    });
  });
});
