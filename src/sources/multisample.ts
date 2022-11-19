import triangle from "../shaders/multisample/triangle.vert.wgsl?raw"
import redFrag from "../shaders/multisample/red.frag.wgsl?raw"

async function initWebGPU(canvas: HTMLCanvasElement) {
    if (!navigator.gpu) throw new Error("Not Support WebGpu")

    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance"
    })

    if (!adapter) throw new Error("No Adapter Found")

    const device = await adapter.requestDevice()
    const context = canvas.getContext('webgpu') as GPUCanvasContext
    const format = navigator.gpu.getPreferredCanvasFormat()
    const devicePixelRatio = window.devicePixelRatio || 1
    const size = {
        width : canvas.clientWidth * devicePixelRatio,
        height : canvas.clientHeight * devicePixelRatio
    }
    canvas.width = size.width
    canvas.height = size.height
    context.configure({
        device,
        format,
        alphaMode: "opaque"
    })

    return { device, context, format, size }
}

async function initPipeline(device: GPUDevice, format: GPUTextureFormat) : Promise<GPURenderPipeline> {
    const descriptor: GPURenderPipelineDescriptor = {
        vertex: {
            module: device.createShaderModule({code: triangle}),
            entryPoint: "main"
        },
        fragment: {
            module: device.createShaderModule({code: redFrag}),
            entryPoint: "main",
            targets: [{format: format}]
        },
        primitive: {
            topology: "triangle-list"
        },
        multisample: {       // todo 新增多重采样配置选项
            count: 4
        },
        layout: "auto"
    }
    return await device.createRenderPipelineAsync(descriptor)
}

function draw(device: GPUDevice, context: GPUCanvasContext, pipeline: GPURenderPipeline) {
    const commandEncoder = device.createCommandEncoder()

    // 多重采样配置
    const curtexture = context.getCurrentTexture()
    const textureSize = {width: curtexture.width, height: curtexture.height}
    const texture = device.createTexture({
        size: textureSize,
        sampleCount: 4,
        format: navigator.gpu.getPreferredCanvasFormat(),
        usage: GPUTextureUsage.RENDER_ATTACHMENT
    })

    const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
            {
                view: texture.createView(),
                resolveTarget: context.getCurrentTexture().createView(), // 接收多重采样后的结果
                loadOp: "clear",
                clearValue: {r: 0.2, g: 0.3, b: 0.3, a: 1.0},
                storeOp: "store"
            }
        ]
    }
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor)
    passEncoder.setPipeline(pipeline)
    passEncoder.draw(3)
    passEncoder.end()
    const gpuCommandBuffer = commandEncoder.finish()
    device.queue.submit([gpuCommandBuffer])
}
async function run() {
    const canvas = document.querySelector("canvas")
    if (!canvas) throw new Error("No Canvas")
    const { device, context, format } = await initWebGPU(canvas)
    const pipeline = await initPipeline(device, format)
    draw(device, context, pipeline)

    window.addEventListener("resize", () => {
        canvas.width = canvas.clientWidth * devicePixelRatio
        canvas.width = canvas.clientHeight * devicePixelRatio
        context.configure({
            device,
            format,
            alphaMode: "opaque"
        })
        draw(device, context, pipeline)
    })
}
run()