import triangle from "../shaders/color_triangle/triangle.vert.wgsl?raw"
import colorFrag from "../shaders/color_triangle/color.frag.wgsl?raw"

// 初始化WebGPU
async function initWebGPU(canvas: HTMLCanvasElement) {
    // 判断当前设备是否支持WebGPU
    if (!navigator.gpu) throw new Error("Not Support WebGPU")
    // 请求Adapter对象，GPU在浏览器中的抽象代理
    const adapter = await navigator.gpu.requestAdapter({
        /* 电源偏好
        high-performance 高性能电源管理
        low-power 节能电源管理模式 
        */
        powerPreference: "high-performance",
    })
    if (!adapter) throw new Error("No Adapter Found")
    //请求GPU设备
    const device = await adapter.requestDevice()
    //获取WebGPU上下文对象
    const context = canvas.getContext("webgpu") as GPUCanvasContext
    //获取浏览器默认的颜色格式
    const format = navigator.gpu.getPreferredCanvasFormat()
    //设备分辨率
    const devicePixelRatio = window.devicePixelRatio || 1
    //canvas尺寸
    const size = {
        width: canvas.clientWidth * devicePixelRatio,
        height: canvas.clientHeight * devicePixelRatio,
    }
    canvas.width = size.width
    canvas.height =size.height
    //配置WebGPU
    context.configure({
        device,
        format,
        // Alpha合成模式，opaque为不透明
        alphaMode: "opaque",
    })

    return { device, context, format, size }
}
// 创建渲染管线
async function initPipeline(
        device: GPUDevice,
        format: GPUTextureFormat
){
    const descriptor: GPURenderPipelineDescriptor = {
        // 顶点着色器
        vertex: {
            // 着色程序
            module: device.createShaderModule({
                code: triangle,
            }),
            // 主函数
            entryPoint: "main",
        },
        // 片元着色器
        fragment: {
            // 着色程序
            module: device.createShaderModule({
                code: colorFrag,
            }),
            // 主函数
            entryPoint: "main",
            // 渲染目标
            targets: [
                {
                    // 颜色格式
                    format: format,
                },
            ],
        },
        // 初始配置
        primitive: {
            //绘制独立三角形
            topology: "triangle-list",
        },
        // 渲染管线的布局
        layout: "auto",
    }

    // todo craete pipeline
    const pipeline = await device.createRenderPipelineAsync(descriptor);

    // todo 创建color buffer
    const colorBuffer = device.createBuffer({
        label: 'GPUBuffer store rgba color',
        size: 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    // todo 先初始化一个蓝色的颜色值
    device.queue.writeBuffer(colorBuffer, 0, new Float32Array([0, 0, 1, 1]));
    // todo 创建一个bindGroup来存储colorBuffer供shader使用
    const uniformGroup = device.createBindGroup({
        label: 'uniform group with colorBuffer',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: colorBuffer
                }
            }
        ]
    })

    return {pipeline, colorBuffer, uniformGroup};
}
// 编写绘图指令，并传递给本地的GPU设备
function draw(
        device: GPUDevice,
        context: GPUCanvasContext,
        pipeline: GPURenderPipeline,
        uniformGroup: GPUBindGroup
) {
    // 创建指令编码器
    const commandEncoder = device.createCommandEncoder()
    // GPU纹理视图
    const view = context.getCurrentTexture().createView()
    // 渲染通道配置数据
    const renderPassDescriptor: GPURenderPassDescriptor = {
        // 颜色附件
        colorAttachments: [
            {
                view: view,
                // 绘图前是否清空view，建议清空clear
                loadOp: "clear", // clear/load
                // 清理画布的颜色
                clearValue: { r: 0.2, g: 0.3, b: 0.3, a: 1.0 },
                //绘制完成后，是否保留颜色信息
                storeOp: "store", // store/discard
            },
        ],
    }
    // 建立渲染通道，类似图层
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor)
    // 传入渲染管线
    passEncoder.setPipeline(pipeline)

    // todo 设置bindGroup
    passEncoder.setBindGroup(0, uniformGroup);

    // 绘图，3 个顶点
    passEncoder.draw(3)
    // 结束编码
    passEncoder.end()
    // 结束指令编写,并返回GPU指令缓冲区
    const gpuCommandBuffer = commandEncoder.finish()
    // 向GPU提交绘图指令，所有指令将在提交后执行
    device.queue.submit([gpuCommandBuffer])
}

async function run() {
    const canvas = document.querySelector("canvas")
    if (!canvas) throw new Error("No Canvas")
    // 初始化WebGPU
    const { device, context, format } = await initWebGPU(canvas)
    // 渲染管道
    const pipelineObj = await initPipeline(device, format)
    // 绘图
    draw(device, context, pipelineObj.pipeline, pipelineObj.uniformGroup);

    // todo 创建颜色选择框
    document.querySelector('input[type="color"]')?.addEventListener('input', (e:Event) => {
        const color = (e.target as HTMLInputElement).value;
        // console.log(color);
        const r = +('0x' + color.slice(1, 3)) / 255;
        const g = +('0x' + color.slice(3, 5)) / 255;
        const b = +('0x' + color.slice(5, 7)) / 255;
        device.queue.writeBuffer(pipelineObj.colorBuffer, 0, new Float32Array([r, g, b, 1]));
        draw(device, context, pipelineObj.pipeline, pipelineObj.uniformGroup);
    })

    // 自适应窗口尺寸
    window.addEventListener("resize", () => {
    canvas.width=canvas.clientWidth * devicePixelRatio
    canvas.height=canvas.clientHeight * devicePixelRatio
        context.configure({
            device,
            format,
            alphaMode: "opaque",
        })
        draw(device, context, pipelineObj.pipeline, pipelineObj.uniformGroup)
    })
}
run()
