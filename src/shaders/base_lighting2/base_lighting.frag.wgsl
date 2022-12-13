
@group(1) @binding(0) var<uniform> ambientIntensity: f32;
@group(1) @binding(1) var<uniform> pointLight: array<vec4<f32>, 2>;

@fragment
fn main(
    @location(0) fragPosition : vec3<f32>,
    @location(1) fragNormal : vec3<f32>,
    @location(2) fragUV : vec2<f32>,
    @location(3) fragColor : vec4<f32>
) -> @location(0) vec4<f32> {
    let objectColor = fragColor.rgb;

    // 判断obj是否为点光源位置处的obj
    if (objectColor.r == 1.0 && objectColor.g == 1.0 && objectColor.b == 1.0) {
        return vec4(objectColor, 1.0);
    }

    let ambientLightColor = vec3(1.0, 1.0, 1.0);
    let pointLightColor = vec3(1.0, 1.0, 1.0);

    var lightResult = vec3(0.0, 0.0, 0.0);
    // ambient
    lightResult += ambientLightColor * ambientIntensity;
    // Point Light
    var pointLightPosition = pointLight[0].xyz;
    var pointLightIntensity: f32 = pointLight[1][0];
    var pointLightRadius: f32 = pointLight[1][1];
    var L = pointLightPosition - fragPosition;
    var distance = length(L);
    if (distance < pointLightRadius) {
        var diffuse: f32 = max(dot(normalize(L), fragNormal), 0.0);
        var distanceFactor: f32 = pow(1.0 - distance / pointLightRadius, 2.0);
        lightResult += pointLightColor * pointLightIntensity * diffuse * distanceFactor;
    }

    return vec4<f32>(objectColor * lightResult, 1.0);
}