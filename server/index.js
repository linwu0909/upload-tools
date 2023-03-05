const Controller = require("./controller");
const http = require("http");
const server = http.createServer();

const controller = new Controller();

server.on("request", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  // 预请求
  if (req.method === "OPTIONS") {
    res.status = 200;
    res.end();
    return;
  }

  // 验证服务器是否已存在该文件或已上传成功的文件切片
  if (req.url === "/verify") {
    await controller.handleVerifyUpload(req, res);
    return;
  }

  // 当文件都上传完成开始合并切片
  if (req.url === "/merge") {
    await controller.handleMerge(req, res);
    return;
  }

  // 通过流形式上传切片
  if (req.url === "/") {
    await controller.handleFormData(req, res);
  }

  if (req.url === "/delete") {
    await controller.deleteFiles(req, res);
  }
});

server.listen(3000, () => console.log("listening port 3000"));
