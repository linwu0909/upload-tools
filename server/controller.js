const multiparty = require("multiparty");
const path = require("path");
const fse = require("fs-extra");

// 提取后缀名
const getExt = filename =>
  filename.slice(filename.lastIndexOf("."), filename.length);

// 大文件存储目录
const UPLOAD_DIR = path.resolve(__dirname, "..", "target");

// 创建临时文件夹用于临时存储 chunk
// 添加 chunkDir 前缀与文件名做区分
const getChunkDir = fileHash =>
  path.resolve(UPLOAD_DIR, `chunkDir_${fileHash}`);

// 写入文件流
const pipeStream = (path, writeStream) =>
  new Promise(resolve => {
    const readStream = fse.createReadStream(path);
    readStream.on("end", () => {
      fse.unlinkSync(path);
      resolve();
    });
    readStream.pipe(writeStream);
  });

// 合并切片
const mergeFileChunk = async (filePath, fileHash, size) => {
  const chunkDir = getChunkDir(fileHash);
  const chunkPaths = await fse.readdir(chunkDir);
  // 根据切片下标进行排序
  chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);
  // 并发写入文件
  await Promise.all(
    chunkPaths.map((chunkPath, index) =>
      pipeStream(
        path.resolve(chunkDir, chunkPath),
        // 根据 size 在指定位置创建可写流
        fse.createWriteStream(filePath, {
          start: index * size
        })
      )
    )
  );
  // 合并后删除保存切片的目录
  fse.rmdirSync(chunkDir);
};

// 通过流接收前端传的数据
const resolvePost = req =>
  new Promise(resolve => {
    let chunk = "";
    req.on("data", data => {
      chunk += data;
    });
    req.on("end", () => {
      resolve(JSON.parse(chunk));
    });
  });

// 返回已上传的所有切片名
const getUploadedList = async fileHash =>
  fse.existsSync(path.resolve(UPLOAD_DIR, fileHash))
    ? await fse.readdir(path.resolve(UPLOAD_DIR, fileHash))
    : [];

module.exports = class {
  // 合并切片
  async handleMerge(req, res) {
    const data = await resolvePost(req);
    const { fileHash, filename, size } = data;
    const ext = getExt(filename);
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);
    await mergeFileChunk(filePath, fileHash, size);
    res.end(
      JSON.stringify({
        code: 0,
        message: "file merged success"
      })
    );
  }

  // 删除所有文件
  // async deleteFiles(req, res) {
  //   await fse.remove(path.resolve(UPLOAD_DIR));
  //   res.end(
  //     JSON.stringify({
  //       code: 0,
  //       message: "file delete success"
  //     })
  //   );
  // }

  // 处理切片
  async handleFormData(req, res) {
    const multipart = new multiparty.Form();

    multipart.parse(req, async (err, fields, files) => {
      if (err) {
        console.error(err);
        res.status = 500;
        res.end("process file chunk failed");
        return;
      }
      const [chunk] = files.chunk;
      const [hash] = fields.hash;
      const [fileHash] = fields.fileHash;
      const [filename] = fields.filename;
      // 文件路径由hash和文件后缀组成
      const filePath = path.resolve(
        UPLOAD_DIR,
        `${fileHash}${getExt(filename)}`
      );
      // 新建切片文件夹用来存储切片
      const chunkDir = getChunkDir(fileHash);
      // 获取当前切片路径
      const chunkPath = path.resolve(chunkDir, hash);

      // 文件存在直接返回
      if (fse.existsSync(filePath)) {
        res.end("file exist");
        return;
      }

      // 切片存在直接返回
      if (fse.existsSync(chunkPath)) {
        res.end("chunk exist");
        return;
      }

      // 切片目录不存在，创建切片目录
      if (!fse.existsSync(chunkDir)) {
        await fse.mkdirs(chunkDir);
      }

      // fs-extra 的 rename 方法 windows 平台会有权限问题 用fse.move代替fse.rename
      // https://github.com/meteor/meteor/issues/7852#issuecomment-255767835
      await fse.move(chunk.path, path.resolve(chunkDir, hash));
      res.end("received file chunk");
    });
  }

  // 验证是否已上传/已上传切片下标
  async handleVerifyUpload(req, res) {
    // 通过流的方式接收前端传的数据 =>chunk可以理解为数据中的一块数据
    const data = await resolvePost(req);
    // 获取文件名和文件hash
    const { fileHash, filename } = data;
    // 获取文件后缀名
    const ext = getExt(filename);
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);
    if (fse.existsSync(filePath)) {
      res.end(
        JSON.stringify({
          shouldUpload: false
        })
      );
    } else {
      let uploadedList = await getUploadedList(getChunkDir(fileHash))
      // 过滤掉苹果自带的隐藏文件以免影响判断
      uploadedList = uploadedList.filter(item => item !== '.DS_Store')
      res.end(
        JSON.stringify({
          shouldUpload: true,
          uploadedList 
        })
      );
    }
  }
};
