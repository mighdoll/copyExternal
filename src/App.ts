main();

// texture created from copyExternalImageToTexture (and createImageBitmap)
// . I expect the printed values to be non-zero, but it only works about 10% of the time. 
// 
// running on macos 113.0.5634.0 (Official Build) canary (arm64)
// works on some older canary builds (e.g. 5541)

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  const texture = await textureFromImageUrl(device, "/bird.jpg");

  // this should print non-zero values, but only sometimes works
  printTexture(device, texture);
}

export async function textureFromImageUrl(
  device: GPUDevice,
  url: string,
  format?: GPUTextureFormat,
  gpuUsage?: GPUTextureUsageFlags
): Promise<GPUTexture> {
  const response = await fetch(url);
  const blob = await response.blob();
  // await new Promise((resolve) => setTimeout(resolve, 200)); // doesn't seem to help
  const imgBitmap = await createImageBitmap(blob);


  const texture = bitmapToTexture(device, imgBitmap, format, gpuUsage, url);
  await device.queue.onSubmittedWorkDone();

  showBitmap(imgBitmap); // show bitmap works when loaded into 2d canvas
  return texture;
}

// show bitmap to separate 2d canvas
function showBitmap(bitmap: ImageBitmap) {
  const canvas: HTMLCanvasElement = document.querySelector("canvas#show-test")!;
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(bitmap, 0, 0);
  }
}

export function bitmapToTexture(
  device: GPUDevice,
  source: ImageBitmap,
  format?: GPUTextureFormat,
  gpuUsage?: GPUTextureUsageFlags,
  label?: string
): GPUTexture {
  const resolvedFormat = format || navigator.gpu.getPreferredCanvasFormat();

  let usage: GPUTextureUsageFlags;
  if (gpuUsage) {
    usage = gpuUsage;
  } else {
    usage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT;
  }

  const textureDescriptor: GPUTextureDescriptor = {
    size: { width: source.width, height: source.height },
    format: resolvedFormat,
    usage,
    label,
  };
  const texture = device.createTexture(textureDescriptor);

  device.queue.copyExternalImageToTexture(
    { source },
    { texture },
    textureDescriptor.size
  );

  return texture;
}

async function printTexture(
  device: GPUDevice,
  texture: GPUTexture,
  pixels = 3
): Promise<void> {
  withTextureCopy(device, texture, (data) => {
    const slice = data.slice(0, pixels * 4);
    console.log(slice);
  });
}

export async function withTextureCopy<T>(
  device: GPUDevice,
  texture: GPUTexture,
  fn: (data: number[]) => T
): Promise<T> {
  const imageTexture: GPUImageCopyTexture = {
    texture,
  };

  // create buffer, padded if necessary to 256 bytes per row
  const components = 4;
  const bytesPerComponent = 1;
  const textureByteWidth = texture.width * components * bytesPerComponent;
  const bufferByteWidth = Math.ceil(textureByteWidth / 256) * 256;
  const bufferBytes = bufferByteWidth * texture.height;
  const buffer = device.createBuffer({
    label: "textureCopy",
    size: bufferBytes,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // copy image to buffer
  const imageDestination: GPUImageCopyBuffer = {
    buffer,
    bytesPerRow: bufferByteWidth,
    rowsPerImage: texture.height,
  };
  const copySize: GPUExtent3DStrict = {
    width: texture.width,
    height: texture.height,
    depthOrArrayLayers: texture.depthOrArrayLayers,
  };
  const commands = device.createCommandEncoder({});
  commands.copyTextureToBuffer(imageTexture, imageDestination, copySize);
  const cmdBuffer = commands.finish();
  device.queue.submit([cmdBuffer]);
  await device.queue.onSubmittedWorkDone();

  // fetch data from buffer 
  await buffer.mapAsync(GPUMapMode.READ);
  const mapped = buffer.getMappedRange();
  const cpuCopy = new Uint8Array(mapped);
  const data = [...cpuCopy];

  try {
    return fn(data);
  } finally {
    buffer.unmap();
    buffer.destroy();
  }
}
