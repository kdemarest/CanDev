// Stubs of the bits of Unity's API that Canopy C# Claude writes uses, so mcs (pkg install mono)
// can check it compiles here, where Unity can't run (Claude, 2026-10-31). Signatures only; nothing
// works. Add what a new script needs. Usage, from /sdcard/dev:
//   mcs -target:library -nowarn:0169,0649 -out:$TMPDIR/check.dll tools/unity-stubs/UnityEngine.cs <files.cs>
namespace UnityEngine
{
    public class Object { }
    public class Component : Object { public Transform transform => null; public GameObject gameObject => null; }
    public class Behaviour : Component { public bool enabled; }
    public class MonoBehaviour : Behaviour { }
    public class GameObject : Object { public Transform transform => null; }
    public class Transform : Component { public Vector3 position, forward; }
    public class Camera : Behaviour { public static Camera main => null; }
    public static class Time { public static float deltaTime => 0; public static float time => 0; }
    public static class Shader
    {
        public static int PropertyToID(string name) => 0;
        public static void SetGlobalVector(int id, Vector4 v) { }
        public static void SetGlobalVectorArray(int id, Vector4[] v) { }
        public static void SetGlobalFloat(int id, float v) { }
    }
    public static class Random { public static float Range(float a, float b) => a; public static int Range(int a, int b) => a; }
    public static class Mathf
    {
        public const float PI = 3.14159265f, Deg2Rad = PI / 180, Rad2Deg = 180 / PI;
        public static float Sin(float f) => 0; public static float Cos(float f) => 0; public static float Sqrt(float f) => 0;
        public static float Max(float a, float b) => a; public static float Min(float a, float b) => a;
        public static int Clamp(int v, int a, int b) => v; public static float Clamp(float v, float a, float b) => v; public static float Clamp01(float v) => v;
        public static float Lerp(float a, float b, float t) => a;
    }
    public struct Vector2
    {
        public float x, y;
        public Vector2(float x, float y) { this.x = x; this.y = y; }
        public static Vector2 right => new Vector2(1, 0);
        public float sqrMagnitude => x * x + y * y;
        public Vector2 normalized => this;
        public static Vector2 operator +(Vector2 a, Vector2 b) => a;
        public static Vector2 operator -(Vector2 a, Vector2 b) => a;
        public static Vector2 operator *(Vector2 a, float f) => a;
        public static Vector2 operator *(float f, Vector2 a) => a;
    }
    public struct Vector3
    {
        public float x, y, z;
        public Vector3(float x, float y, float z) { this.x = x; this.y = y; this.z = z; }
        public static Vector3 operator +(Vector3 a, Vector3 b) => a;
        public static Vector3 operator -(Vector3 a, Vector3 b) => a;
        public static Vector3 operator *(Vector3 a, float f) => a;
    }
    public struct Vector4
    {
        public float x, y, z, w;
        public Vector4(float x, float y, float z, float w) { this.x = x; this.y = y; this.z = z; this.w = w; }
        public static Vector4 zero => new Vector4(0, 0, 0, 0);
    }
    public class TooltipAttribute : System.Attribute { public TooltipAttribute(string t) { } }
    public class RangeAttribute : System.Attribute { public RangeAttribute(float a, float b) { } }
    public class HeaderAttribute : System.Attribute { public HeaderAttribute(string t) { } }
}
