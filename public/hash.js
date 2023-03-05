// 引入spark
self.importScripts("/spark-md5.min.js");

// 生成文件 hash
self.onmessage = e => {
  // 获取切片文件列表
  const { fileChunkList } = e.data;
  const spark = new self.SparkMD5.ArrayBuffer();
  let percentage = 0;
  let count = 0;
  const loadNext = index => {
    const reader = new FileReader();
    // 按顺序获取切片
    reader.readAsArrayBuffer(fileChunkList[index].file);
    reader.onload = e => {
      count++;
      spark.append(e.target.result);
      // 分成多少份就进行多少次计算 都计算完成后关闭
      if (count === fileChunkList.length) {
        self.postMessage({
          percentage: 100,
          hash: spark.end()
        });
        self.close();
      } else {
        // 100 / 份数 获得每份占的比例
        percentage += 100 / fileChunkList.length;
        self.postMessage({
          percentage
        });
        loadNext(count);
      }
    };
  };
  loadNext(0);
};
