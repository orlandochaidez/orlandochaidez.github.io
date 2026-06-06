
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const bird = {
  x: 100,
  y: 200,
  width: 40,
  height: 40,
  gravity: 0.5,
  lift: -10,
  velocity: 0
};

let pipes = [];
let score = 0;
let gameOver = false;

function createPipe() {
  const gap = 180;
  const topHeight = Math.random() * (canvas.height - gap - 200) + 50;

  pipes.push({
    x: canvas.width,
    width: 80,
    top: topHeight,
    bottom: canvas.height - topHeight - gap
  });
}

setInterval(() => {
  if (!gameOver) createPipe();
}, 1300);

function drawBird() {
  ctx.fillStyle = "yellow";
  ctx.beginPath();
  ctx.arc(bird.x, bird.y, bird.width / 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawPipes() {
  ctx.fillStyle = "green";

  pipes.forEach(pipe => {
    ctx.fillRect(pipe.x, 0, pipe.width, pipe.top);

    ctx.fillRect(
      pipe.x,
      canvas.height - pipe.bottom,
      pipe.width,
      pipe.bottom
    );
  });
}

function update() {
  if (gameOver) return;

  bird.velocity += bird.gravity;
  bird.y += bird.velocity;

  pipes.forEach(pipe => {
    pipe.x -= 3;

    // collision
    if (
      bird.x + bird.width / 2 > pipe.x &&
      bird.x - bird.width / 2 < pipe.x + pipe.width &&
      (
        bird.y - bird.height / 2 < pipe.top ||
        bird.y + bird.height / 2 > canvas.height - pipe.bottom
      )
    ) {
      gameOver = true;
    }

    // score
    if (!pipe.passed && pipe.x + pipe.width < bird.x) {
      pipe.passed = true;
      score++;
    }
  });

  // floor / ceiling
  if (bird.y > canvas.height || bird.y < 0) {
    gameOver = true;
  }

  pipes = pipes.filter(pipe => pipe.x + pipe.width > 0);
}

function drawScore() {
  ctx.fillStyle = "white";
  ctx.font = "48px Arial";
  ctx.fillText(score, canvas.width / 2, 80);
}

function drawGameOver() {
  if (!gameOver) return;

  ctx.fillStyle = "white";
  ctx.font = "64px Arial";
  ctx.fillText(
    "GAME OVER",
    canvas.width / 2 - 180,
    canvas.height / 2
  );
}

function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  update();

  drawBird();
  drawPipes();
  drawScore();
  drawGameOver();

  requestAnimationFrame(gameLoop);
}

function flap() {
  if (gameOver) {
    location.reload();
    return;
  }

  bird.velocity = bird.lift;
}

function flap() {
  if (gameOver) {
    location.reload();
    return;
  }
  bird.velocity = bird.lift;
}

// desktop keyboard
window.addEventListener("keydown", e => {
  if (e.code === "Space") flap();
});

// desktop click
window.addEventListener("click", flap);

// mobile touch
window.addEventListener("touchstart", e => {
  e.preventDefault();
  flap();
}, { passive: false });

gameLoop();
